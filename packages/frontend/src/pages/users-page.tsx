import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Users } from "lucide-react";
import { api } from "../lib/api";
import type { Location, Skill, UserDetail } from "../types";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const roleBadge = (role: string) => {
  if (role === "ADMIN") return <Badge variant="destructive">Admin</Badge>;
  if (role === "MANAGER") return <Badge variant="warning">Manager</Badge>;
  return <Badge variant="secondary">Staff</Badge>;
};

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MANAGER" | "STAFF">("STAFF");
  const [password, setPassword] = useState("");
  const [desiredWeeklyHours, setDesiredWeeklyHours] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      api.post("/users", { email, firstName, lastName, role, password, desiredWeeklyHours: desiredWeeklyHours || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "Failed to create user.");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Create User</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Password (min. 8 chars)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="STAFF">Staff</option>
                <option value="MANAGER">Manager</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Desired hrs/week</Label>
              <Input
                type="number" min={0} max={80}
                value={desiredWeeklyHours}
                onChange={(e) => setDesiredWeeklyHours(e.target.value ? Number(e.target.value) : "")}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!email || !firstName || !lastName || !password || mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create User"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  skills,
  locations,
}: {
  user: UserDetail;
  skills: Skill[];
  locations: Location[];
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const addSkillMutation = useMutation({
    mutationFn: async (skillId: string) => api.post(`/users/${user.id}/skills`, { skillId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const removeSkillMutation = useMutation({
    mutationFn: async (skillId: string) => api.delete(`/users/${user.id}/skills/${skillId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const addCertMutation = useMutation({
    mutationFn: async (locationId: string) => api.post(`/users/${user.id}/certifications`, { locationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const removeCertMutation = useMutation({
    mutationFn: async (locationId: string) => api.delete(`/users/${user.id}/certifications/${locationId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async () => api.patch(`/users/${user.id}`, { isActive: !user.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  const userSkillIds = new Set(user.skills.map((s) => s.skill.id));
  const userLocationIds = new Set(user.certifications.map((c) => c.locationId));

  return (
    <>
      <tr
        className={cn("border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer", !user.isActive && "opacity-50")}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 pl-4">
          {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </td>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 select-none">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-slate-400">{user.email}</p>
            </div>
          </div>
        </td>
        <td className="py-3 pr-4">{roleBadge(user.role)}</td>
        <td className="py-3 pr-4 text-sm text-slate-600">
          {user.skills.map((s) => s.skill.name).join(", ") || <span className="text-slate-300">—</span>}
        </td>
        <td className="py-3 pr-4 text-sm text-slate-600">
          {user.certifications.map((c) => c.location.name).join(", ") || <span className="text-slate-300">—</span>}
        </td>
        <td className="py-3 pr-4">
          <span className={cn("text-xs font-medium", user.isActive ? "text-green-600" : "text-slate-400")}>
            {user.isActive ? "Active" : "Inactive"}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/70">
          <td colSpan={6} className="px-10 py-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Skills */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Skills</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {skills.map((sk) => (
                    <button
                      key={sk.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (userSkillIds.has(sk.id)) removeSkillMutation.mutate(sk.id);
                        else addSkillMutation.mutate(sk.id);
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                        userSkillIds.has(sk.id)
                          ? "bg-blue-100 border-blue-200 text-blue-700"
                          : "bg-white border-slate-200 text-slate-500 hover:border-blue-300",
                      )}
                    >
                      {userSkillIds.has(sk.id) ? "✓ " : "+ "}{sk.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Certifications */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Location Certs</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (userLocationIds.has(loc.id)) removeCertMutation.mutate(loc.id);
                        else addCertMutation.mutate(loc.id);
                      }}
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                        userLocationIds.has(loc.id)
                          ? "bg-green-100 border-green-200 text-green-700"
                          : "bg-white border-slate-200 text-slate-500 hover:border-green-300",
                      )}
                    >
                      {userLocationIds.has(loc.id) ? "✓ " : "+ "}{loc.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Actions</p>
                <Button
                  size="sm"
                  variant={user.isActive ? "outline" : "secondary"}
                  onClick={(e) => { e.stopPropagation(); toggleActiveMutation.mutate(); }}
                >
                  {user.isActive ? "Deactivate" : "Reactivate"}
                </Button>
                {user.desiredWeeklyHours != null && (
                  <p className="text-xs text-slate-400 mt-2">Desired: {user.desiredWeeklyHours}h/week</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function UsersPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await api.get<{ users: UserDetail[] }>("/users");
      return response.data.users;
    },
  });

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const response = await api.get<{ skills: Skill[] }>("/skills");
      return response.data.skills;
    },
  });

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const response = await api.get<{ locations: Location[] }>("/locations");
      return response.data.locations;
    },
  });

  const filtered = (usersQuery.data ?? []).filter((u) => {
    const q = search.toLowerCase();
    return (
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
            <Users size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">User Management</h1>
            <p className="text-sm text-slate-500">
              Create staff, assign skills, and manage location certifications.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus size={15} /> Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search by name, email, or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <CardDescription>
              {filtered.length} of {usersQuery.data?.length ?? 0} users
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {usersQuery.isLoading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-slate-400">
              <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
              <span className="text-sm">Loading users…</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="w-8 py-2.5 pl-4" />
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Skills
                  </th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Certifications
                  </th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      skills={skillsQuery.data ?? []}
                      locations={locationsQuery.data ?? []}
                    />
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
