import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { Providers } from "./providers";
import "./globals.css";

/**
 * Root layout — the structural half of the deleted `src/components/Layout.tsx`.
 *
 * `<Outlet />` becomes `{children}`, which is the only structural change: every
 * route in the app sits inside the header and footer, exactly as it did under
 * the React Router wrapper in `src/App.tsx`.
 */
export const metadata: Metadata = {
  title: "PURE — Premium Apparel",
  description:
    "Premium fashion and lifestyle products curated for the modern individual.",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
