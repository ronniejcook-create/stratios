import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Everything under these paths requires a signed-in user.
const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/onboarding(.*)', '/select-organization(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
