import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { StaffBadgeCardProps } from "./StaffBadgeCard";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Badge mesh with flip animation
function Badge({
  displayName,
  roleTitle,
  avatarUrl,
  mentorName,
  mentorAvatarUrl,
  persona,
  modelLabel,
  onClick,
}: StaffBadgeCardProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [flipped, setFlipped] = useState(false);
  const targetRotationRef = useRef(0);

  const handleClick = () => {
    const next = !flipped;
    setFlipped(next);
    targetRotationRef.current = next ? Math.PI : 0;
    onClick?.();
  };

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        targetRotationRef.current,
        0.1,
      );
    }
  });

  const initials = getInitials(displayName);
  const mentorInitials = mentorName ? getInitials(mentorName) : "?";

  return (
    <group ref={groupRef}>
      {/* Badge body */}
      <RoundedBox
        args={[2.4, 3.4, 0.08]}
        radius={0.12}
        smoothness={4}
        onClick={handleClick}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.3} metalness={0.1} />
      </RoundedBox>

      {/* Front face HTML content */}
      <Html
        position={[0, 0, 0.045]}
        transform
        occlude
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            width: 240,
            height: 340,
            background: "white",
            borderRadius: "12px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, sans-serif",
            boxSizing: "border-box",
          }}
        >
          {/* Gradient header */}
          <div
            style={{
              height: 80,
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(99,102,241,0.05))",
              flexShrink: 0,
            }}
          />

          {/* Avatar overlapping header */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: -36,
              flexShrink: 0,
            }}
          >
            <Avatar
              style={{
                width: 72,
                height: 72,
                border: "3px solid white",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}
            >
              {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
              <AvatarFallback
                style={{
                  background: "rgba(99,102,241,0.1)",
                  color: "rgb(99,102,241)",
                  fontWeight: "bold",
                  fontSize: 22,
                }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Name & role */}
          <div
            style={{
              marginTop: 10,
              padding: "0 16px",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: "#111",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </div>
            {roleTitle && (
              <div
                style={{
                  fontSize: 12,
                  color: "#666",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {roleTitle}
              </div>
            )}
          </div>

          {/* Divider */}
          <div
            style={{
              margin: "14px 16px 0",
              borderTop: "1px solid #e5e7eb",
              flexShrink: 0,
            }}
          />

          {/* Mentor */}
          <div style={{ marginTop: 12, padding: "0 16px", flexShrink: 0 }}>
            <div
              style={{
                fontSize: 10,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              Mentor
            </div>
            {mentorName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar style={{ width: 24, height: 24 }}>
                  {mentorAvatarUrl && (
                    <AvatarImage src={mentorAvatarUrl} alt={mentorName} />
                  )}
                  <AvatarFallback
                    style={{
                      fontSize: 9,
                      background: "#f3f4f6",
                      color: "#6b7280",
                    }}
                  >
                    {mentorInitials}
                  </AvatarFallback>
                </Avatar>
                <span
                  style={{
                    fontSize: 13,
                    color: "#374151",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {mentorName}
                </span>
              </div>
            ) : (
              <span
                style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}
              >
                No mentor assigned
              </span>
            )}
          </div>

          {/* Click hint */}
          <div
            style={{
              marginTop: "auto",
              padding: "0 16px 14px",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 10, color: "#d1d5db" }}>
              Click to flip
            </span>
          </div>
        </div>
      </Html>

      {/* Back face HTML content */}
      <Html
        position={[0, 0, -0.045]}
        rotation={[0, Math.PI, 0]}
        transform
        occlude
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            width: 240,
            height: 340,
            background: "white",
            borderRadius: "12px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, sans-serif",
            boxSizing: "border-box",
          }}
        >
          {/* Header */}
          <div
            style={{
              height: 56,
              background:
                "linear-gradient(135deg, #f3f4f6, rgba(99,102,241,0.08))",
              flexShrink: 0,
              display: "flex",
              alignItems: "flex-end",
              padding: "0 16px 10px",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              About
            </span>
          </div>

          {/* Persona content */}
          <div
            style={{
              flex: 1,
              padding: "12px 16px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}
            >
              Persona
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#374151",
                lineHeight: 1.6,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 9,
                WebkitBoxOrient: "vertical",
              }}
            >
              {persona?.slice(0, 250) || "No persona description available."}
            </div>
          </div>

          {/* Model label */}
          <div
            style={{
              flexShrink: 0,
              padding: "10px 16px 16px",
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Model
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#374151",
                background: "#f3f4f6",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {modelLabel ?? "—"}
            </span>
          </div>
        </div>
      </Html>
    </group>
  );
}

// Default export for lazy loading
export default function StaffBadgeCard3D(props: StaffBadgeCardProps) {
  return (
    <div
      style={{ width: 280, height: 400, cursor: "pointer" }}
      className={
        props.selected ? "ring-2 ring-primary ring-offset-2 rounded-xl" : ""
      }
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 40 }}
        style={{ borderRadius: "0.75rem" }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} intensity={0.5} />
        <directionalLight position={[-3, -3, -3]} intensity={0.2} />
        <Badge {...props} />
      </Canvas>
    </div>
  );
}
