import { redirect } from "next/navigation";

// "/" has no page of its own: signed-in users land on Home, and /home sends everyone else to /login.
export default function RootPage() {
  redirect("/home");
}
