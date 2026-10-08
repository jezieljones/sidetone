import { Clock3 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const recentCalls = [
  {
    title: "Morgan Lee",
    detail: "Pricing call",
    status: "Notes ready",
    href: "/calls/demo"
  },
  {
    title: "Unknown caller",
    detail: "Conference-in test",
    status: "Processing",
    href: "/calls/demo"
  }
];

export function RecentCalls() {
  return (
    <Card>
      <CardHeader className="p-6 md:p-8">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-3xl">Recent calls</CardTitle>
          <Badge variant="neutral">Preview</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid px-6 pb-6 md:px-8 md:pb-8">
        {recentCalls.map((call) => (
          <a
            className="flex items-center justify-between gap-4 border-t border-border py-4 transition first:border-t-0 first:pt-0 hover:text-primary"
            href={call.href}
            key={call.title}
          >
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md border border-primary/50 bg-[#122742] text-primary">
                <Clock3 className="size-5" />
              </div>
              <div>
                <p className="font-semibold">{call.title}</p>
                <p className="text-sm text-muted-foreground">{call.detail}</p>
              </div>
            </div>
            <Badge variant={call.status === "Notes ready" ? "success" : "warning"}>
              {call.status}
            </Badge>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}
