import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { urlValidator } from "../../../shared/url";
import * as tls from "tls";
import * as forge from "node-forge";
import fs from "fs/promises";
import { TRPCError } from "@trpc/server";
import { Url } from "@prisma/client";
import * as crypto from "crypto";

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

const prefix = "-----BEGIN CERTIFICATE-----\n";
const postfix = "-----END CERTIFICATE-----";

type Store = "Google Chrome" | "Mozilla Firefox" | "Microsoft Edge";

const getStoreFile = (store: Store) => {
  if (store === "Google Chrome") return "./chromium_root_store.pem";
  if (store === "Mozilla Firefox") return "./mozilla_root_store.pem";
  if (store === "Microsoft Edge") return "./msft_root_store.pem";
  return "none";
};

const testUrl = (hostname: string, port: number, store: Store) => {
  // return new Promise<Set<tls.DetailedPeerCertificate>>(
  return new Promise<Chain>(async (resolve, reject) => {
    const socket = tls.connect(
      {
        port: port,
        timeout: 3000,
        host: hostname,
        servername: hostname,
        ca: [
          // await fs.readFile("./chromium_root_store.pem"),
          // await fs.readFile("./mozilla_root_store.pem"),
          await fs.readFile(getStoreFile(store)),
          // await fs.readFile("./msft_root_store.pem"),
        ],
        rejectUnauthorized: false,
      },
      () => {
        let peerCert = socket.getPeerCertificate(true);
        // const selfSigned = peerCert.issuer === peerCert.subject;
        // const authError = socket.authorizationError;
        // console.log({ peerCert, authError, selfSigned });

        const list = new Set<tls.DetailedPeerCertificate>();
        const chain = [];

        do {
          list.add(peerCert);
          // console.log("--->", peerCert);
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
        // console.log(chain);
        socket.end(() => {
          console.log("cliend closed successfully");
        });
        // console.log({
        //   certs: chain,
        //   errorCode: !socket.authorized ? socket.authorizationError : null,
        //   authorized: socket.authorized,
        // });
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
  initcerts: publicProcedure.query(async ({ ctx }) => {
    // console.log("initcerts");
    const cas = await Promise.all(
      [
        "./chromium_root_store.pem",
        "./mozilla_root_store.pem",
        "./msft_root_store.pem",
      ].map(async (ca) => {
        const regex =
          /^-----BEGIN CERTIFICATE-----\r?\n((?:(?!-----).*\r?\n)*)-----END CERTIFICATE-----/gm;

        const pemFile = (await fs.readFile(ca)).toString();
        const getStoreName = (ca: string): Store => {
          if (ca === "./chromium_root_store.pem") return "Google Chrome";
          if (ca === "./mozilla_root_store.pem") return "Mozilla Firefox";
          if (ca === "./msft_root_store.pem") return "Microsoft Edge";
          throw new TRPCError({
            message: "Invalid store",
            code: "BAD_REQUEST",
          });
        };
        const store = getStoreName(ca);
        let m;
        const certs: crypto.X509Certificate[] = [];
        while ((m = regex.exec(pemFile)) !== null) {
          // This is necessary to avoid infinite loops with zero-width matches
          if (m.index === regex.lastIndex) {
            regex.lastIndex++;
          }
          // console.log(i);
          const x509 = new crypto.X509Certificate(
            Buffer.from(prefix + m[1] + postfix)
          );
          certs.push(x509);
          // x509.publicKey
          // console.log(x509);
          // ctx.prism
          // const cert = forge.pki.certificateFromPem(prefix + m[1] + postfix);
        }
        console.log(store);
        await ctx.prisma.trustStore.create({
          data: {
            name: store,
            total: certs.length,
            certificates: {
              // create: certs as any,
              create: certs.map((cert) => ({
                value: {
                  validFrom: cert.validFrom,
                  validTo: cert.validTo,
                  keyType: cert.publicKey.asymmetricKeyType,
                  modulos: cert.publicKey.asymmetricKeyDetails!.modulusLength,
                },
              })),
              // {
              //   value: certs as any,
              // },
            },
          },
        });
        return { ca, certs: certs.length };
      })
    );
    // // console.log(pem);
    // return null;
    return cas;
  }),
  getStore: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.prisma.trustStore.findFirst({
        where: {
          name: input.name,
        },
        include: { certificates: true },
      });
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
        const getTrustLevel = (chain: Chain) => {
          if (chain.authorized) {
            return 3;
          }
          if (ErrorCodes.includes(chain.errorCode!)) {
            return 2;
          }
          throw new TRPCError({
            message: "Something went wrong",
            code: "INTERNAL_SERVER_ERROR",
          });
        };
        try {
          const chainChrome = await testUrl(
            hostname,
            specifiedPort,
            "Google Chrome"
          );
          const trustChrome = getTrustLevel(chainChrome);

          const chainFirefox = await testUrl(
            hostname,
            specifiedPort,
            "Microsoft Edge"
          );
          const trustFirefox = getTrustLevel(chainChrome);

          const chainEdge = await testUrl(
            hostname,
            specifiedPort,
            "Mozilla Firefox"
          );
          const trustEdge = getTrustLevel(chainEdge);
          return await ctx.prisma.url.create({
            data: {
              host: hostname,
              tls: true,
              chain: chainFirefox,
              trust: trustFirefox,
              chainFirefox,
              trustFirefox,
              chainChrome,
              trustChrome,
              chainEdge,
              trustEdge,
            },
          });
        } catch (err) {
          if (err instanceof TRPCError) {
            // HTTPS not supported
            if (err.message === "HTTPS not supported") {
              return await ctx.prisma.url.create({
                data: {
                  host: hostname,
                  tls: false,
                  trust: 1,
                  chain: {},
                  chainChrome: {},
                  trustChrome: 1,
                  chainFirefox: {},
                  trustFirefox: 1,
                  chainEdge: {},
                  trustEdge: 1,
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
        await Promise.all(
          input.urlsOrHosts.map(async (url) => {
            try {
              const chain = await getChain(url);
              certificateChains.push(chain);
            } catch (err) {
              errors = true;
            }
          })
        );
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
