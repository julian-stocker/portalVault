import { permanentRedirect } from "next/navigation";

/**
 * The collection used to live here. Old links keep working rather than
 * breaking, which costs one file.
 */
export default function DashboardPage(): never {
  permanentRedirect("/collection");
}
