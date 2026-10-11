import { createFileRoute } from "@tanstack/react-router";
import { MESARI_BRAND } from "@/lib/branding";

export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({
            name: "Mesari Comandas",
            short_name: "Mesari",
            description: "Comandas digitais para restaurante.",
            start_url: "/",
            display: "standalone",
            background_color: "#ffffff",
            theme_color: "#0e2a2b",
            icons: [
              {
                src: MESARI_BRAND.symbol,
                sizes: "any",
                type: "image/png",
                purpose: "any",
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/manifest+json; charset=utf-8" },
          },
        ),
    },
  },
});
