/**
 * 404 page.
 *
 * The legacy `src/pages/NotFound.tsx` logged the path from `useLocation()` in a
 * `useEffect`. Here the path is available from the server, so Next's own 404
 * handler covers the logging case without a client component at all.
 *
 * One caveat worth knowing before it is filed as a regression: when this page is
 * reached via `notFound()` from a dynamic route (an unknown product id, say),
 * Next streams it rather than server-rendering it — the HTML body arrives empty
 * and the page appears on hydration. Real browsers see the styled 404 and the
 * status is a correct 404 either way; only a no-JS request sees a blank page.
 * This is upstream behaviour, tracked as vercel/next.js#62228, and is not
 * something the route handlers here can fix.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-4">Oops! Page not found</p>
        <a href="/" className="text-blue-500 hover:text-blue-700 underline">
          Return to Home
        </a>
      </div>
    </div>
  );
}