import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function GeneratePage() {
  return (
    <div className="flex justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Generate a post</CardTitle>
          <CardDescription>Write LinkedIn post drafts with a local model. Nothing is posted for you.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The post form is coming in the next milestone.
        </CardContent>
      </Card>
    </div>
  );
}
