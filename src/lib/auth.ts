import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { autoClaimReposForUser } from "@/lib/verification";

/**
 * Central Auth.js (next-auth v5) configuration.
 *
 * OAuth is an OPTIONAL "verify instantly with GitHub" convenience — never
 * required. The primary path is the zero-permission bio-challenge
 * (lib/verification.ts). Both converge on the same thing: User.builderVerified.
 *
 * Scope is now just `read:user user:email` — no `public_repo`. This app no
 * longer stars anything on a user's behalf (see lib/scoring.ts: the star
 * mechanism is detection-only, polling GET /users/{username}/starred), so
 * there's nothing to write, and no reason to ask for write permission.
 *
 * Pinned to next-auth's v5 line rather than v4 for the reasons recorded in
 * the security-hardening branch history (v4.24.8-4.24.15 all carry a
 * critical CVE; 4.24.7 doesn't support Next 15).
 */

/**
 * A pre-existing bio-verified User row (see lib/verification.ts) has no
 * linked Account — it was created keyed by githubLogin alone, with no OAuth
 * ever involved. If that same person later uses "verify instantly with
 * GitHub", the base PrismaAdapter would try to INSERT a brand new User row
 * and hit the githubLogin/githubId unique constraint, crashing sign-in.
 * This wrapper intercepts createUser to merge into that existing row instead
 * of creating a duplicate — the two verification paths must converge on one
 * identity, never fork into two.
 */
function buildAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    async createUser(data) {
      const githubLogin = (data as { githubLogin?: string }).githubLogin;
      const existing = githubLogin
        ? await prisma.user.findUnique({ where: { githubLogin } })
        : null;
      if (existing) {
        return prisma.user.update({
          where: { id: existing.id },
          data: {
            name: data.name ?? existing.name,
            email: data.email ?? existing.email,
            image: data.image ?? existing.image,
          },
        });
      }
      return base.createUser!(data);
    },
  };
}

const config: NextAuthConfig = {
  adapter: buildAdapter(),
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      authorization: {
        params: { scope: "read:user user:email" },
      },
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
        };
      },
    }),
  ],
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "github") {
        const gh = profile as unknown as {
          id: number;
          login: string;
          bio?: string;
          html_url?: string;
          public_repos?: number;
          followers?: number;
        };

        const alreadyVerified = await prisma.user
          .findUnique({ where: { id: user.id }, select: { builderVerified: true } })
          .then((u: { builderVerified: boolean } | null) => u?.builderVerified ?? false);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            githubId: gh.id,
            githubLogin: gh.login,
            githubBio: gh.bio ?? null,
            githubUrl: gh.html_url ?? null,
            publicRepos: gh.public_repos ?? null,
            followers: gh.followers ?? null,
            // OAuth proves control at least as strongly as the bio
            // challenge, so it's the other route to the same flag.
            builderVerified: true,
            verifiedAt: alreadyVerified ? undefined : new Date(),
          },
        });

        if (!alreadyVerified && user.id) {
          await autoClaimReposForUser(user.id, gh.login);
          await prisma.activityEvent.create({
            data: { userId: user.id, type: "BUILDER_VERIFIED", message: "Verified builder identity via GitHub sign-in." },
          });
        }
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id: string }).id = user.id;
        (session.user as { githubLogin?: string | null }).githubLogin = (
          user as { githubLogin?: string | null }
        ).githubLogin;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
