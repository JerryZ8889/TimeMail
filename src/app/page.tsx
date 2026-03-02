import { redirect } from "next/navigation";
import { DEFAULT_TOPIC } from "../config/topics";

export default function Home() {
  redirect(`/news?topic=${DEFAULT_TOPIC}`);
}
