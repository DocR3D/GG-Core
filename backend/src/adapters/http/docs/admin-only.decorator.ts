import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';

/**
 * For a route only an admin may call (see the access middleware): the padlock of the documentation (a session cookie
 * or the admin token, either one is enough) and the two answers the middleware gives before the route runs.
 */
export function AdminOnly() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiCookieAuth(),
    ApiUnauthorizedResponse({ description: 'Nobody is signed in (no session cookie, no admin token)' }),
    ApiForbiddenResponse({ description: 'Signed in, but without the admin role' }),
  );
}
