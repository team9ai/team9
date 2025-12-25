import { createFileRoute } from "@tanstack/react-router";
import { RegisterExample } from "@/examples/RegisterExample";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <RegisterExample />
      </div>
    </div>
  );
}
