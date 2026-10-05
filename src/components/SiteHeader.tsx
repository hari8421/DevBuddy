import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Logo, Wordmark } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const LINKS = [
  { href: "/#formats", label: "Formats" },
  { href: "/#features", label: "Features" },
  { href: "/errors", label: "Error directory" },
  { href: "/#faq", label: "FAQ" },
];

/** Sticky header shared by every page. No account, so nothing to sign in to. */
export function SiteHeader() {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <nav className="container flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <Wordmark />
          </Link>
          <div className="hidden items-center gap-6 text-sm md:flex">
            {LINKS.map((link) => {
              const isRoute = !link.href.startsWith("/#");
              const active = isRoute && location.pathname === link.href;
              return (
                <Link
                  key={link.href}
                  to={isRoute ? link.href : "/"}
                  onClick={(event) => {
                    if (!isRoute) {
                      event.preventDefault();
                      document
                        .getElementById(link.href.slice(2))
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                  className={
                    active
                      ? "text-foreground"
                      : "text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild size="sm">
            <Link to="/app">Analyze a log</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
