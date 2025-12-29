import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRegister, useCurrentUser } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/register")({
  component: Register,
});

function Register() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const navigate = useNavigate();
  const register = useRegister();
  const { data: currentUser, isLoading } = useCurrentUser();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (password !== confirmPassword) {
      setError("Passwords do not match!");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      return;
    }

    if (username.length < 3) {
      setError("Username must be at least 3 characters long");
      return;
    }

    try {
      await register.mutateAsync({
        email,
        username,
        password,
        displayName: displayName || undefined,
      });
      // Redirect to home page after successful registration
      navigate({ to: "/" });
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message ||
        err?.message ||
        "Registration failed. Please try again.";
      setError(errorMessage);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  // Redirect if already logged in
  if (currentUser) {
    navigate({ to: "/" });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white py-12">
      <div className="w-full max-w-100 px-4">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Team9</h1>
          <p className="text-gray-600 text-lg">Create your account</p>
        </div>

        {/* Registration Form */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
          <form onSubmit={handleRegister} className="space-y-5">
            {/* Email Field */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="block text-sm font-semibold text-gray-900"
              >
                Email address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@work-email.com"
                className="w-full h-11 px-3 border-gray-300 focus:border-purple-600 focus:ring-purple-600"
                required
                autoFocus
              />
              <p className="text-xs text-gray-500">
                We recommend using your work email address
              </p>
            </div>

            {/* Username Field */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block text-sm font-semibold text-gray-900"
              >
                Username
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Choose a username"
                className="w-full h-11 px-3 border-gray-300 focus:border-purple-600 focus:ring-purple-600"
                required
                minLength={3}
                maxLength={100}
              />
              <p className="text-xs text-gray-500">
                Username must be 3-100 characters
              </p>
            </div>

            {/* Display Name Field (Optional) */}
            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className="block text-sm font-semibold text-gray-900"
              >
                Display name{" "}
                <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full h-11 px-3 border-gray-300 focus:border-purple-600 focus:ring-purple-600"
                maxLength={255}
              />
              <p className="text-xs text-gray-500">
                This is how your name will appear in Team9
              </p>
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-semibold text-gray-900"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className="w-full h-11 px-3 border-gray-300 focus:border-purple-600 focus:ring-purple-600"
                required
                minLength={6}
                maxLength={100}
              />
              <p className="text-xs text-gray-500">
                Password must be at least 6 characters
              </p>
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-semibold text-gray-900"
              >
                Confirm password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                className="w-full h-11 px-3 border-gray-300 focus:border-purple-600 focus:ring-purple-600"
                required
                minLength={6}
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-11 bg-purple-600 hover:bg-purple-700 text-white font-semibold text-base"
              disabled={register.isPending}
            >
              {register.isPending ? "Creating account..." : "Create Account"}
            </Button>
          </form>
        </div>

        {/* Sign In Link */}
        <div className="text-center mt-6">
          <p className="text-gray-600 text-sm">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-purple-600 hover:underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-xs text-gray-500">
          <p>
            By creating an account, you're agreeing to our{" "}
            <a href="#" className="text-purple-600 hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-purple-600 hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
