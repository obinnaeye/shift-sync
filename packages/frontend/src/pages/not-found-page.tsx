import { Link } from "react-router-dom";
import { LayoutDashboard, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <SearchX size={28} className="text-slate-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
          <p className="text-slate-500 text-sm mt-2">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
        <Link to="/dashboard">
          <Button className="gap-2">
            <LayoutDashboard size={15} />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
