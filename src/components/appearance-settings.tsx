"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  // The saved theme is only known in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>Light, dark, or follow your computer&apos;s setting.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Theme"
          value={mounted ? (theme ?? "light") : ""}
          onValueChange={(value) => value && setTheme(value)}
        >
          <ToggleGroupItem value="light">
            <Sun />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <Moon />
            Dark
          </ToggleGroupItem>
          <ToggleGroupItem value="system">
            <Monitor />
            System
          </ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}
