import { useState } from "react";
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from "@/hooks/useUsers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function UsersExample() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useUsers({ page, pageSize: 10 });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const handleCreateUser = async () => {
    try {
      await createUser.mutateAsync({
        name: "New User",
        email: "user@example.com",
      });
      alert("User created successfully!");
    } catch (error) {
      alert("Failed to create user");
    }
  };

  const handleUpdateUser = async (id: string) => {
    try {
      await updateUser.mutateAsync({
        id,
        data: { name: "Updated Name" },
      });
      alert("User updated successfully!");
    } catch (error) {
      alert("Failed to update user");
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (confirm("Are you sure you want to delete this user?")) {
      try {
        await deleteUser.mutateAsync(id);
        alert("User deleted successfully!");
      } catch (error) {
        alert("Failed to delete user");
      }
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Users List</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCreateUser} className="mb-4">
            Create User
          </Button>

          <div className="space-y-2">
            {data?.data.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between border p-2 rounded"
              >
                <div>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-sm text-gray-500">{user.email}</div>
                </div>
                <div className="space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUpdateUser(user.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDeleteUser(user.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-4">
            <Button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span>
              Page {page} of{" "}
              {Math.ceil((data?.total || 0) / (data?.pageSize || 1))}
            </span>
            <Button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data || page >= Math.ceil(data.total / data.pageSize)}
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
