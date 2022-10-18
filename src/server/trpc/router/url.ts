import { router, publicProcedure } from "../trpc";
import { z } from "zod";
import { urlValidator } from "../../../shared/url";
import * as tls from "tls";
// import https from "https";
import http from "http";
import fs from "fs/promises";

const testUrl = (url: string) => {
  return new Promise(async (resolve, reject) => {
    const { hostname, port } = new URL(url);
    console.log("\n\n\n\n HOSTNAMEEEE", hostname, port);
    const socket = tls.connect(
      {
        // port: 443,
        port: port ? Number(port) : 443,
        timeout: 3000,
        host: hostname,
        servername: hostname,
        ca: [
          await fs.readFile("./chromium_root_store.pem"),
          await fs.readFile("./mozilla_root_store.pem"),
          await fs.readFile("./msft_root_store.pem"),
        ],
      },
      () => {
        let peerCert = socket.getPeerCertificate(true);
        let lasIssuer = "";
        const list = new Set();
        const chain = [];
        do {
          list.add(peerCert);
          const cert = {
            subject: peerCert.subject,
            issuer: peerCert.issuer,
            valid_from: peerCert.valid_from,
            valid_to: peerCert.valid_to,
          };
          lasIssuer = cert.issuer.CN ?? lasIssuer;
          console.log(cert, "\n");
          chain.push(cert);
          peerCert = peerCert.issuerCertificate;
        } while (
          peerCert &&
          typeof peerCert === "object" &&
          !list.has(peerCert)
        );
        socket.end(() => {
          console.log("cliend closed successfully");
        });
        resolve({ chain, lasIssuerCN: lasIssuer, host: hostname });
      }
    );
    socket.on("timeout", (conn) => {
      console.log("\n\n\ntimeout", conn);
      reject("TLS connection timeout");
    });
    socket.on("error", (conn) => {
      console.log("\n\n\n\nerror", conn.message);
      reject(conn.message);
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
      const addedUrlInfo = new Array();
      const addedUrlsInput = new Array<string>();
      // const addedPeerCertificates = new Array<tls.PeerCertificate>();
      // const addedPeerCertificates = new Array();
      if (typeof input.urlOrHost === "string") {
        const completedURL =
          input.urlOrHost.startsWith("https://") ||
          input.urlOrHost.startsWith("http://")
            ? input.urlOrHost
            : `https://${input.urlOrHost}`;
        console.log("\n\n\n\n\n\n\n\n\n", completedURL);
        try {
          const urlInfo = await testUrl(completedURL);
          addedUrlInfo.push(urlInfo);
          addedUrlsInput.push(completedURL);
        } catch (e) {
          if (e === "TLS connection timeout") {
            console.log("TIMEDOUT NO TLS");
            const { hostname } = new URL(completedURL);
            console.log("\n\n\n\n\nhostname", hostname);
            await ctx.prisma.url.create({
              data: {
                host: hostname,
                tls: false,
                trustLevel: (0).toString(),
                chain: {},
              },
            });
          } else {
            throw e;
          }
        }
      }
      if (input.urlsOrHosts !== null) {
        for (const urlOrHost of input.urlsOrHosts) {
          const completedURL =
            urlOrHost.startsWith("https://") || urlOrHost.startsWith("http://")
              ? urlOrHost
              : `https://${urlOrHost}`;
          try {
            const urlInfo = await testUrl(completedURL);
            addedUrlInfo.push(urlInfo);
            addedUrlsInput.push(completedURL);
          } catch (e) {
            if (e === "TLS connection timeout") {
              console.log("TIMEDOUT NO TLS");
              const { hostname } = new URL(completedURL);
              console.log("\n\n\n\n\nhostname", hostname);
              await ctx.prisma.url.create({
                data: {
                  host: hostname,
                  tls: false,
                  trustLevel: (0).toString(),
                  chain: {},
                },
              });
            } else {
              throw e;
            }
          }
        }
      }
      console.log("\n\n\n\n\n\n\n\n\n all good");
      for (let i = 0; i < addedUrlInfo.length; i++) {
        const urlInfo = addedUrlInfo[i]!;
        const urlInput = addedUrlsInput[i]!;

        const { hostname } = new URL(urlInput);
        await ctx.prisma.url.create({
          data: {
            host: hostname,
            tls: true,
            // chain: JSON.stringify(urlInfo.chain),
            trustLevel: (3).toString(),
            chain: urlInfo.chain,
          },
        });
      }
      return JSON.stringify(addedUrlInfo);
    }),
  getAll: publicProcedure.query(({ ctx }) => {
    return ctx.prisma.url.findMany();
  }),
  deleteAll: publicProcedure.mutation(async ({ ctx }) => {
    return await ctx.prisma.url.deleteMany();
  }),
});
