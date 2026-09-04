import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      githubLogin?: string | null;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    githubLogin?: string | null;
  }
}
