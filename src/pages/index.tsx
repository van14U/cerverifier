import { Prisma, Url } from "@prisma/client";
import type { NextPage } from "next";
import Head from "next/head";
import { useForm } from "react-hook-form";
import { urlValidator, UrlValidatorType } from "../shared/url";
import { trpc } from "../utils/trpc";
import { zodResolver } from "@hookform/resolvers/zod";
import React from "react";
import { BiLinkExternal as ExternalLinkIcon } from "react-icons/bi";
import { GiPlainCircle as CircleIcon } from "react-icons/gi";
import { GiBreakingChain as ChainIcon } from "react-icons/gi";
import { error } from "console";
import { ZodError } from "zod";

type ScoreContentType = {
  score: number;
  vendor: "Microsoft Edge" | "Google Chrome" | "Mozilla Firefox";
};
const ScoreContent: React.FC<ScoreContentType> = ({ score, vendor }) => {
  return (
    <div className="flex items-center justify-between px-8 sm:justify-center sm:p-0">
      <div className="sm:hidden">
        <p className="text-center">{vendor}</p>
      </div>
      <div className="flex items-center justify-center text-4xl">
        <CircleIcon className={`px-2 ${score >= 1 && "text-green-400"} `} />
        <CircleIcon className={`px-2 ${score >= 2 && "text-green-400"}`} />
        <CircleIcon className={`px-2 ${score === 3 && "text-green-400"} `} />
      </div>
    </div>
  );
};

const gridClasses = "hidden rounded-lg bg-gray-700 p-4 sm:block";
const UrlItem: React.FC<{ url: Url }> = ({ url }) => {
  return (
    <>
      <div
        tabIndex={0}
        className="collapse rounded-lg border-none bg-gray-700 sm:hidden"
      >
        <div className="collapse-title flex items-center gap-2 truncate text-xl font-medium">
          <a href={`https://${url.host}`}>
            <ExternalLinkIcon />
          </a>
          <a className="truncate">{url.host}</a>
        </div>
        <div className="collapse-content">
          <div className="flex flex-col gap-2">
            <ScoreContent
              vendor="Microsoft Edge"
              score={Number(url.trustLevel)}
            />
            <ScoreContent
              vendor="Google Chrome"
              score={Number(url.trustLevel)}
            />
            <ScoreContent
              vendor="Mozilla Firefox"
              score={Number(url.trustLevel)}
            />
            <label
              htmlFor={`chain-modal-${url.id}`}
              className="modal-button btn btn-sm"
            >
              show chain
            </label>
          </div>
        </div>
      </div>

      <div className={gridClasses}>
        <div className="flex h-full items-center gap-2">
          <div className="tooltip" data-tip="Show Chain">
            <label
              htmlFor={`chain-modal-${url.id}`}
              className="modal-button btn btn-sm border-none bg-gray-700 text-xl hover:bg-gray-600 hover:text-white"
            >
              <ChainIcon />
            </label>
          </div>
          <a href={`https://${url.host}`}>
            <ExternalLinkIcon />
          </a>
          <a className="truncate">{url.host}</a>
        </div>
      </div>
      <div className={gridClasses}>
        <ScoreContent vendor="Microsoft Edge" score={Number(url.trustLevel)} />
      </div>
      <div className={gridClasses}>
        <ScoreContent vendor="Google Chrome" score={Number(url.trustLevel)} />
      </div>
      <div className={gridClasses}>
        <ScoreContent vendor="Mozilla Firefox" score={Number(url.trustLevel)} />
      </div>

      <input
        type="checkbox"
        id={`chain-modal-${url.id}`}
        className="modal-toggle"
      />
      <label htmlFor={`chain-modal-${url.id}`} className="modal cursor-pointer">
        <div className="modal-box relative flex flex-col gap-2">
          <h3 className="text-lg font-bold">Certificates Chain</h3>
          <div className="flex flex-col gap-3">
            {url.chain &&
              typeof (url.chain as Prisma.JsonArray).length !== "undefined" &&
              (url.chain as Prisma.JsonArray).map((u) => (
                <div>
                  <p>
                    Issuer:
                    {JSON.stringify((u as Prisma.JsonObject)?.issuer ?? "")}
                  </p>
                  <p>
                    Subject:
                    {JSON.stringify((u as Prisma.JsonObject)?.subject ?? "")}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </label>
      {/* </div> */}
    </>
  );
};

type UrlGridContentParams = {
  urls?: Url[];
};
const UrlGridContent: React.FC<UrlGridContentParams> = ({ urls }) => {
  if (!urls || urls.length === 0) {
    return null;
  }
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Labels
          labels={["URL", "Microsoft", "Google Chrome", "Mozilla Firefox"]}
        />
        {urls.map((url) => (
          <div
            key={url.id}
            className="grid grid-cols-1 gap-4 sm:col-span-4 sm:grid-cols-4"
          >
            <UrlItem url={url} />
          </div>
        ))}
      </div>
    </div>
  );
};

const UrlsForm = () => {
  const [errMsg, setErrMsg] = React.useState<string>("");
  const addUrlMutation = trpc.url.addUrl.useMutation({
    onSuccess: (data) => {
      console.log("url added successfully", JSON.parse(data));
      window.location.reload();
    },
    onError: (data) => {
      console.log(data.data);
      try {
        const err = ZodError.create(JSON.parse(data.message));
        if (err instanceof ZodError) {
          console.log("zoderror");
        }
        const errMsgs = err.errors.map((e) => `${e.message}`).join("\n");
        setErrMsg(`Error ${data.data?.httpStatus}: ${errMsgs}`);
      } catch {
        setErrMsg(`Error ${data.data?.code ?? "PARSE_ERROR"}: ${data.message}`);
      }
    },
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<UrlValidatorType>({
    resolver: zodResolver(urlValidator),
    mode: "onChange",
    defaultValues: {
      // url: null,
      urlOrHost: null,
      urlsOrHosts: null,
    },
  });
  const onSubmit = (data: UrlValidatorType) => {
    console.log("data submitted", data);
    addUrlMutation.mutate(data);
  };
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full flex-col justify-center gap-4 self-start lg:flex-row"
    >
      <div
        className={`${
          errors.urlOrHost?.message ? "tooltip tooltip-open" : ""
        } tooltip-error w-full`}
        data-tip={errors.urlOrHost?.message}
      >
        <input
          placeholder="Type URL"
          className="input w-full"
          {...register("urlOrHost")}
        />
      </div>
      <div
        className={`${
          errors.urlsOrHosts?.message ? "tooltip tooltip-open" : ""
        } tooltip-error`}
        data-tip={errors.urlsOrHosts?.message}
      >
        <label className="flex w-full cursor-pointer flex-col">
          <input
            type="file"
            className="order-2 max-w-[12rem] text-gray-400 file:hidden"
            accept="text/plain"
            {...register("urlsOrHosts")}
          />
          <div className="btn order-1 border-gray-700 hover:border-gray-700">
            Batch
          </div>
        </label>
      </div>

      <button
        type="submit"
        // className="btn border-gray-700 hover:border-gray-700"
        className={`btn border-gray-700 hover:border-gray-700 ${
          addUrlMutation.isLoading && "loading"
        }`}
      >
        Verify
      </button>
      {addUrlMutation.isError && (
        <div className="toast toast-start">
          <div className="alert alert-error">
            <div>
              <span>{errMsg}</span>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};

const Home: NextPage = () => {
  // const hello = trpc.example.hello.useQuery({ text: "from tRPC" });
  const urls = trpc.url.getAll.useQuery();
  const clearAllMutation = trpc.url.deleteAll.useMutation({
    onSuccess: () => {
      console.log("clear 200");
      window.location.reload();
    },
  });
  return (
    <>
      <Head>
        <title>Trusts Certificates Verifier</title>
        <meta name="description" content="Generated by create-t3-app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto flex min-h-screen flex-col items-center gap-4 px-8">
        <h1 className="w-full py-8 text-4xl font-extrabold leading-normal lg:text-6xl">
          <p>Digital Certificates</p>
          <p>Trust Verifier</p>
        </h1>
        {/* <h2>{hello.data?.greeting}</h2> */}
        <UrlsForm />
        <UrlGridContent urls={urls.data} />
        <button
          className={`btn border-gray-700 hover:border-gray-700 ${
            clearAllMutation.isLoading && "loading"
          }`}
          onClick={() => clearAllMutation.mutate()}
        >
          Clear All
        </button>
        <TrustStoreInfo />
      </main>
    </>
  );
};

export default Home;

const TrustStoreInfo = () => (
  <div className="mt-auto flex w-full flex-col items-center justify-between p-4 sm:flex-row">
    <a href="https://ccadb-public.secure.force.com/mozilla/IncludedCACertificateReport">
      Mozilla
    </a>
    <a href="https://ccadb-public.secure.force.com/microsoft/IncludedCACertificateReportForMSFT">
      Microsoft
    </a>
    <a href="https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/root_store.md">
      Google
    </a>
  </div>
);

const Labels = ({ labels }: { labels: string[] }) => (
  <>
    {labels.map((i) => (
      <div
        key={i}
        className="hidden items-center justify-center font-bold sm:flex"
      >
        <p className="truncate">{i}</p>
      </div>
    ))}
  </>
);
