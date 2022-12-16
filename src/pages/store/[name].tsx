import { Certificate, TrustStore } from "@prisma/client";
import { useRouter } from "next/router";
import { trpc } from "../../utils/trpc";

const StoreView: React.FC<{
  data: TrustStore & { certificates: Certificate[] };
}> = (props) => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-lg bg-slate-600 p-2 font-semibold">
        {props.data.name}
      </div>
      <div className="rounded-lg bg-slate-600 p-2 font-semibold">
        Total: {props.data.total}
      </div>
      <div className="rounded-lg bg-slate-600 p-2 font-semibold">
        Certificates
      </div>
      <>
        {props.data.certificates.map((cert) => (
          <div key={Math.random()} className="rounded-lg bg-slate-600 p-2">
            <div>{JSON.stringify(cert.value, null, 4)}</div>
          </div>
        ))}
      </>
    </div>
  );
};

const StoreContent: React.FC<{ name: string }> = (props) => {
  const { data, isLoading } = trpc.url.getStore.useQuery({ name: props.name });
  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        Loading...
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        Store not found
      </div>
    );
  }
  return <StoreView data={data} />;
};

const StorePage = () => {
  const { query } = useRouter();
  const { name } = query;
  if (!name || typeof name !== "string") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        Invalid store name
      </div>
    );
  }
  return <StoreContent name={name} />;
};

export default StorePage;
