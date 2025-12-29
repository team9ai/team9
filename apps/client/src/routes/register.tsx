import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRegister, useCurrentUser } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/register")({
  component: Register,
});

function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registrationToken, setRegistrationToken] = useState("");

  const register = useRegister();
  const { data: currentUser } = useCurrentUser();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }

    if (password.length < 8) {
      alert("Password must be at least 8 characters long");
      return;
    }

    try {
      await register.mutateAsync({
        username,
        password,
        deviceName: "Web Browser",
        registrationToken: registrationToken || undefined,
      });
      alert("Registration successful!");
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error || error?.message || "Unknown error";
      const errorDetails = error?.response?.data?.errcode || "";
      console.error("Registration error details:", error?.response?.data);
      alert(
        `Registration failed: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ""}`,
      );
    }
  };

  if (currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Already Registered</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="font-medium">{currentUser.name}</div>
                  <div className="text-sm text-gray-500">{currentUser.id}</div>
                </div>
                <p className="text-sm text-gray-600">
                  You are already logged in. Please logout first if you want to
                  register a new account.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  required
                  minLength={3}
                />
                <p className="text-xs text-gray-500">
                  Username must be at least 3 characters long
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  required
                  minLength={8}
                />
                <p className="text-xs text-gray-500">
                  Password must be at least 8 characters long
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="confirmPassword"
                  className="text-sm font-medium"
                >
                  Confirm Password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="registrationToken"
                  className="text-sm font-medium"
                >
                  Registration Token (optional)
                </label>
                <Input
                  id="registrationToken"
                  type="text"
                  value={registrationToken}
                  onChange={(e) => setRegistrationToken(e.target.value)}
                  placeholder="Enter registration token if required"
                />
                <p className="text-xs text-gray-500">
                  If your server requires a registration token, enter it here
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={register.isPending}
              >
                {register.isPending ? "Registering..." : "Register"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
