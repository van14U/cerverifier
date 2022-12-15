import { router, publicProcedure } from "../trpc";
import { z, ZodEffects, ZodError } from "zod";
import { urlValidator } from "../../../shared/url";
import * as tls from "tls";
import fs from "fs/promises";
import { TRPCError } from "@trpc/server";
import { Url } from "@prisma/client";

const getFullUrl = (url: string) =>
  url.startsWith("https://") || url.startsWith("http://")
    ? url
    : `https://${url}`;

type CertType = {
  subject: any;
  issuer: any;
  valid_from: string;
  valid_to: string;
  pem: string;
  pubKey: string;
};

const ErrorCodes = [
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
] as const;

type ErrorCode = typeof ErrorCodes[number];

type Chain = {
  certs: CertType[];
  errorCode: ErrorCode | null;
  authorized: boolean;
};

const testUrl = (hostname: string, port: number) => {
  // return new Promise<Set<tls.DetailedPeerCertificate>>(
  return new Promise<Chain>(async (resolve, reject) => {
    const socket = tls.connect(
      {
        port: port,
        timeout: 3000,
        host: hostname,
        servername: hostname,
        // ca: [
        //   await fs.readFile("./chromium_root_store.pem"),
        //   await fs.readFile("./mozilla_root_store.pem"),
        //   await fs.readFile("./msft_root_store.pem"),
        // ],
        rejectUnauthorized: false,
      },
      () => {
        let peerCert = socket.getPeerCertificate(true);
        const selfSigned = peerCert.issuer === peerCert.subject;
        const authError = socket.authorizationError;
        console.log({ peerCert, authError, selfSigned });
        let prefix = "-----BEGIN CERTIFICATE-----\n";
        let postfix = "-----END CERTIFICATE-----";
        let pemText =
          prefix +
          peerCert.raw
            .toString("base64")
            .match(/.{0,64}/g)
            ?.join("\n") +
          postfix;

        console.log(pemText);
        console.log(peerCert.infoAccess);

        const list = new Set<tls.DetailedPeerCertificate>();
        const chain = [];

        do {
          list.add(peerCert);
          console.log("--->", peerCert);
          const cert: CertType = {
            subject: peerCert.subject,
            issuer: peerCert.issuer,
            valid_from: peerCert.valid_from,
            valid_to: peerCert.valid_to,
            pem:
              prefix +
              peerCert.raw
                .toString("base64")
                .match(/.{0,64}/g)
                ?.join("\n") +
              postfix,
            // info: peerCert.infoAccess,
            pubKey: (peerCert as any).pubkey.toString("base64"),
          };
          chain.push(cert);
          peerCert = peerCert.issuerCertificate;
        } while (
          peerCert &&
          typeof peerCert === "object" &&
          !list.has(peerCert)
        );
        console.log(chain);
        socket.end(() => {
          console.log("cliend closed successfully");
        });
        console.log({
          certs: chain,
          errorCode: !socket.authorized ? socket.authorizationError : null,
          authorized: socket.authorized,
        });
        resolve({
          certs: chain,
          errorCode: !socket.authorized
            ? (String(socket.authorizationError) as ErrorCode)
            : null,
          authorized: socket.authorized,
        });
      }
    );
    socket.on("secureConnect", () => {
      console.log(`Successfully connected to ${hostname}:${port}`);
      console.log(socket.authorized);
      console.log(socket.authorizationError);
    });
    socket.on("timeout", () => {
      reject(
        new TRPCError({ code: "TIMEOUT", message: "TLS connection timeout" })
      );
    });
    socket.on("error", (error) => {
      console.log("::: ==== :::: ==== error ==== :::: ====");
      console.log({ code: error.code, msg: error.message });
      if (error.code === "ERR_SSL_WRONG_VERSION_NUMBER") {
        reject(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "HTTPS not supported",
          })
        );
      }
      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${error.code}`,
        })
      );
    });
  });
};

export const urlRouter = router({
  hello: publicProcedure
    .input(z.object({ text: z.string().nullish() }).nullish())
    .query(({ input }) => {
      return {
        greeting: `Hello ${input?.text ?? "world"}`,
      };
    }),
  addUrl: publicProcedure
    .input(urlValidator)
    .mutation(async ({ input, ctx }) => {
      const certificateChains: Url[] = [];

      const getChain = async (url: string) => {
        const fullURL = getFullUrl(url);
        const { hostname, port } = new URL(fullURL);
        const specifiedPort = port
          ? Number(port)
          : url.startsWith("http://")
          ? 80
          : 443;

        console.log({
          url,
          hostname,
          port,
        });
        try {
          const chain = await testUrl(hostname, specifiedPort);
          if (chain.authorized) {
            return await ctx.prisma.url.create({
              data: {
                host: hostname,
                tls: true,
                trust: 3,
                chain,
              },
            });
          }
          if (ErrorCodes.includes(chain.errorCode!)) {
            return await ctx.prisma.url.create({
              data: {
                host: hostname,
                tls: true,
                trust: 2,
                chain,
              },
            });
          }
          throw new TRPCError({
            message: "Something went wrong",
            code: "INTERNAL_SERVER_ERROR",
          });
        } catch (err) {
          if (err instanceof TRPCError) {
            // HTTP not supported
            if (err.message === "HTTPS not supported") {
              return await ctx.prisma.url.create({
                data: {
                  host: hostname,
                  tls: false,
                  trust: 1,
                  chain: {},
                },
              });
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      };

      if (typeof input.urlOrHost === "string") {
        const chain = await getChain(input.urlOrHost);
        certificateChains.push(chain);
      }
      let errors = false;
      if (input.urlsOrHosts !== null) {
        input.urlsOrHosts.forEach(async (url) => {
          try {
            const chain = await getChain(url);
            certificateChains.push(chain);
          } catch (err) {
            errors = true;
          }
        });
      }
      return { errors, inserted: certificateChains.length };
    }),
  getAll: publicProcedure.query(({ ctx }) => {
    return ctx.prisma.url.findMany();
  }),
  deleteAll: publicProcedure.mutation(async ({ ctx }) => {
    return await ctx.prisma.url.deleteMany();
  }),
});
