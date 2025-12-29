import { createFileRoute, Link } from "@tanstack/react-router";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Index,
  loader: async () => {
    /* You can add data loading logic here if needed */
  },
});

function Index() {
  const { data: currentUser, isLoading } = useCurrentUser();
  const logout = useLogout();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <main className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-6">Team9</h1>
        <p className="mb-8 text-gray-600">
          Welcome to Team9 - Your collaborative workspace!
        </p>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">
              Authentication Status
            </h2>
            {isLoading ? (
              <p>Loading...</p>
            ) : currentUser ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Logged in as:</p>
                  <p className="font-medium text-lg">
                    {currentUser.displayName || currentUser.username}
                  </p>
                  <p className="text-sm text-gray-500">
                    @{currentUser.username}
                  </p>
                  <p className="text-sm text-gray-500">{currentUser.email}</p>
                </div>
                <Button
                  onClick={handleLogout}
                  variant="destructive"
                  disabled={logout.isPending}
                >
                  {logout.isPending ? "Logging out..." : "Logout"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-gray-600">You are not logged in.</p>
                <div className="flex gap-4">
                  <Link to="/login">
                    <Button>Login</Button>
                  </Link>
                  <Link to="/register">
                    <Button variant="outline">Register</Button>
                  </Link>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Quick Links</h2>
            <div className="flex gap-4">
              <Link to="/about">
                <Button variant="outline">About</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
