import { z } from "zod";

const hostNameRegex =
  /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]/;
// /^((?!-)[A-Za-z0-9-]{1, 63}(?<!-)\\.)+[A-Za-z]{2, 6}$/;

const urlOrHostValidator = z.string().url().or(z.string().regex(hostNameRegex));

const urlOrHostArrayValidator = z.array(urlOrHostValidator).max(100).nullable();

const parseTextFileUrls = async (f: File) => {
  const value = (await f.text()).split(/\r?\n/);
  if (value.length > 1 && value![value.length - 1]!.trim() === "") {
    value.splice(value.length - 1, 1);
  }
  return urlOrHostArrayValidator.safeParse(value);
};

export const urlValidator = z
  .object({
    urlOrHost: urlOrHostValidator
      .or(z.literal("").transform(() => null))
      .nullable(),
    urlsOrHosts:
      typeof window === "undefined"
        ? urlOrHostArrayValidator
        : z
            .instanceof(FileList)
            .transform(async (fileList, ctx) => {
              const f = fileList.item(0);
              if (f === null) {
                return null;
              }
              const isTextFile =
                "text/plain".includes(f.type) && f.name.includes(".txt");
              if (!isTextFile) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "Only .txt files are allowed",
                });
                return null;
              }
              const mxsz = 128;
              if (f.size / 1024 > mxsz) {
                console.log("size KB", f.size / 1024);
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `Max size is ${mxsz}KB`,
                });
                return null;
              }
              const parsed = await parseTextFileUrls(f);
              if (!parsed.success) {
                console.log(parsed.error.errors);
                const errMsg = parsed.error.errors
                  .map(
                    (err) =>
                      `${err.message} at line ${
                        typeof err.path[0] === "number"
                          ? err.path[0] + 1
                          : err.path
                      }`
                  )
                  .join("\n");
                console.log(errMsg);
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: errMsg,
                });
                return null;
              }
              return parsed.data;
            })
            .nullable(),
  })
  .refine((data) => !(data.urlsOrHosts === null && data.urlOrHost === null), {
    message: "You need to typ at least 1 url",
    path: ["urlOrHost"],
  });

export type UrlValidatorType = z.infer<typeof urlValidator>;
