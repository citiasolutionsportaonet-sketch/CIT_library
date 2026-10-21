import { redirect } from "next/navigation";
import { myTenants } from "@/modules/tenants/service";
import { getSessionUser } from "@/server/tenant-context";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const tenants = await myTenants(user.id);
  if (tenants.length === 0) redirect("/sem-acesso");
  redirect(`/${tenants[0].tenant.slug}/produtos`);
}
