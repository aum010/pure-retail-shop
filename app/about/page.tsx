/**
 * `/about` — the placeholder the legacy app rendered inline in its route table.
 * Kept as a page so the header and footer links keep resolving.
 */
export default function AboutPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-2xl">About Us</h1>
    </div>
  );
}