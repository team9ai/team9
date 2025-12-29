import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useLogin, useCurrentUser, useLogout } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const login = useLogin();
  const logout = useLogout();
  const { data: currentUser, isLoading } = useCurrentUser();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await login.mutateAsync({
        username,
        password,
        deviceName: "Web Browser",
      });
      alert("Login successful!");
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error || error?.message || "Unknown error";
      const errorDetails = error?.response?.data?.errcode || "";
      console.error("Login error details:", error?.response?.data);
      alert(
        `Login failed: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ""}`,
      );
    }
  };

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      alert("Logout successful!");
    } catch (error) {
      alert("Logout failed");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div>Loading...</div>
      </div>
    );
  }

  if (currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Welcome!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="font-medium">{currentUser.name}</div>
                <div className="text-sm text-gray-500">{currentUser.id}</div>
              </div>
              <Button onClick={handleLogout} className="w-full">
                Logout
              </Button>
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
            <CardTitle>Login</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                />
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
                  placeholder="Enter your password"
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={login.isPending}
              >
                {login.isPending ? "Logging in..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
