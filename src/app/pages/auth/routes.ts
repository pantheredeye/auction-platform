import { route } from "rwsdk/router";
import { LoginPage } from "./LoginPage";
import { sessions } from "@/session/store";

export const authRoutes = [
  route("/login", LoginPage),
  route("/logout", async function ({ request, response }) {
    await sessions.remove(request, response.headers);
    response.headers.set("Location", "/");
    return new Response(null, { status: 302, headers: response.headers });
  }),
];
