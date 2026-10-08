import { Pin, X } from "lucide-react";
import { ModePersonaChip } from "./ModePersonaChip";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const coachCards = [
  {
    mode: "negotiate",
    text: "Ask what would make this a yes.",
    reason: "They hesitated after price. Clarify the win condition.",
    priority: "high"
  },
  {
    mode: "support",
    text: "Reflect back what they said before solving.",
    reason: "This keeps the conversation grounded.",
    priority: "normal"
  },
  {
    mode: "close_the_deal",
    text: "Summarize the agreement now.",
    reason: "There is enough alignment to lock next steps.",
    priority: "normal"
  }
];

const notesCards = [
  {
    mode: "Roster",
    text: "Two players may leave after spring.",
    reason: "Confirm the names before sending an update to parents."
  },
  {
    mode: "Schedule",
    text: "Thursday practice moves to Field 3 at 6:30.",
    reason: "Field 1 has a conflict with the older group."
  },
  {
    mode: "Uniforms",
    text: "Sizes are due before Friday's order.",
    reason: "Coach Maya needs the final count by noon."
  }
];

export function CoachCardStack({ variant = "coach" }: { variant?: "coach" | "notes" }) {
  const cards = variant === "notes" ? notesCards : coachCards;
  const showActions = variant === "coach";

  return (
    <div className="enamel-panel overflow-hidden">
      {cards.map((card, index) => (
        <div
          className={
            index === 0
              ? "grid gap-3 bg-primary/10 p-4"
              : "grid gap-3 border-t border-border p-4"
          }
          key={card.text}
        >
          <div className="flex items-center justify-between gap-3">
            {showActions ? (
              <ModePersonaChip
                active={index === 0}
                as="div"
                className="w-fit"
                mode={card.mode}
                showPersona={false}
              />
            ) : (
              <Badge variant={index === 0 ? "primary" : "neutral"}>{card.mode}</Badge>
            )}
            {showActions ? (
              <div className="flex gap-1">
                <Button aria-label="Pin card" size="icon" variant="ghost">
                  <Pin className="size-4" />
                </Button>
                <Button aria-label="Dismiss card" size="icon" variant="ghost">
                  <X className="size-4" />
                </Button>
              </div>
            ) : null}
          </div>
          <p className="text-lg font-semibold">{card.text}</p>
          <p className="text-sm leading-6 text-muted-foreground">{card.reason}</p>
        </div>
      ))}
    </div>
  );
}
