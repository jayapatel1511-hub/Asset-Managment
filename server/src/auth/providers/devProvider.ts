/**
 * The development identity provider: `x-ams-dev-user` names a demo identity.
 *
 * It exists so that the 98 tests that predate WS-W3, and every screen a developer opens on a
 * laptop, keep working exactly as they did — an unrecognised or absent header still resolves to
 * the Field User. Everything that changed is *behind* it: the header now produces a `Principal`,
 * and roles and office scope are looked up in the directory rather than baked into the header's
 * answer. That is what makes the switch to Entra a configuration change instead of a rewrite.
 *
 * It has no interactive flow. `/api/auth/sign-in` under this provider answers 501 with an
 * explanation rather than pretending: there is no identity provider to redirect to, and a fake
 * redirect would hide the fact that the real one has never been exercised.
 */
import type { FastifyRequest } from "fastify";
import { DEV_USER_HEADER, resolveDevUser } from "../devAuth";
import { AuthConfigurationError } from "../settings";
import type { IdentityProvider, Principal, SignInCompletion, SignInStart } from "./index";

const NO_INTERACTIVE_SIGN_IN =
  'AMS_AUTH="dev" has no sign-in flow: the development identity is named by the ' +
  `${DEV_USER_HEADER} header. Set AMS_AUTH=oidc with an Entra app registration to use a real one.`;

export function createDevProvider(): IdentityProvider {
  return {
    name: "dev",
    interactive: false,

    authenticateRequest(req: FastifyRequest): Principal | null {
      const demo = resolveDevUser(req.headers[DEV_USER_HEADER]);
      if (!demo) return null;
      return { upn: demo.upn, objectId: demo.objectId, tenantId: demo.tenantId, displayName: demo.displayName };
    },

    async beginSignIn(): Promise<SignInStart> {
      throw new AuthConfigurationError(NO_INTERACTIVE_SIGN_IN);
    },

    async completeSignIn(): Promise<SignInCompletion> {
      throw new AuthConfigurationError(NO_INTERACTIVE_SIGN_IN);
    },

    endSessionUrl(): string | null {
      return null;
    },
  };
}
