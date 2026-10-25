import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import { isAdminEmail } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { ensurePrimaryAgent, updateUser } from "@/lib/db/queries";
import { accounts, sessions, users, verificationTokens, type User } from "@/lib/db/schema";
import { env } from "@/lib/env";

const baseAdapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

const adapter: Adapter = {
  ...baseAdapter,
  // First sign-in: new users start on the waitlist when WAITLIST_MODE=true.
  createUser: (data) =>
    baseAdapter.createUser!({
      ...data,
      status: env.WAITLIST_MODE ? "waitlist" : "active",
    } as AdapterUser),
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    session({ session, user }) {
      const u = user as AdapterUser & Pick<User, "status" | "timezone">;
      session.user.id = u.id;
      session.user.status = u.status;
      session.user.timezone = u.timezone;
      session.user.isAdmin = isAdminEmail(u.email);
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await ensurePrimaryAgent(user.id);
    },
    // Auth.js only saves the Google photo on the first sign-in; keep it current, since people
    // change their Google photo (or name, which changes Google's letter avatar).
    async signIn({ user, profile }) {
      const picture = typeof profile?.picture === "string" ? profile.picture : undefined;
      if (user.id && picture && picture !== user.image) await updateUser(user.id, { image: picture });
    },
  },
});
