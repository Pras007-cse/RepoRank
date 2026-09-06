import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

/**
 * Central NextAuth configuration.
 *
 * - Uses the GitHub OAuth provider with the `public_repo` scope, which is the
 *   minimum needed to read a user's starred repos and star repos on their
 *   behalf server-side. We deliberately do NOT request broader scopes.
 * - The GitHub access token is captured in the `jwt` callback and persisted
 *   encrypted on the User row (via `signIn`/`session` hooks) so background
 *   jobs and webhook handlers can verify star state without the client ever
 *   holding or seeing the raw token.
 * - Sessions are database-backed (Prisma adapter) so we can revoke access by
 *   deleting Session rows if needed.
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      authorization: {
        params: { scope: "read:user user:email public_repo" },
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
      if (account?.provider === "github" && account.access_token) {
        const gh = profile as unknown as {
          id: number;
          login: string;
          bio?: string;
          html_url?: string;
          public_repos?: number;
          followers?: number;
        };

        await prisma.user.update({
          where: { id: user.id },
          data: {
            githubId: gh.id,
            githubLogin: gh.login,
            githubBio: gh.bio ?? null,
            githubUrl: gh.html_url ?? null,
            publicRepos: gh.public_repos ?? null,
            followers: gh.followers ?? null,
            // Encrypted at rest; only decrypted server-side by lib/github.ts
            githubAccessTokenEnc: encryptSecret(account.access_token),
          },
        });
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
