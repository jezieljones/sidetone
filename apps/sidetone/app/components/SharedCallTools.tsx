"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { Copy, LoaderCircle, LogIn, MessageCircle, Save, Send } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }
}

export function SharedCallTools({
  callTitle,
  token,
  transcriptText
}: {
  callTitle: string;
  token: string;
  transcriptText: string;
}) {
  const storageKey = `sidetone:shared-chat:${token}`;
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const importSharedCall = useMutation(api.calls.importSharedCall);
  const transcriptAvailable = Boolean(transcriptText.trim());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [importState, setImportState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setMessages(parsed.slice(-20));
        }
      }
    } catch {
      setMessages([]);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-20)));
    } catch {
      // Local history is a convenience, not a blocker.
    }
  }, [messages, storageKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isAsking]);

  const suggestedQuestions = useMemo(() => [
    "What should happen next?",
    "What did we agree to?",
    "What risks or blockers came up?"
  ], []);

  async function copyTranscript() {
    if (!transcriptAvailable) {
      return;
    }

    const copied = await writeClipboard(transcriptText);
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  async function saveSharedCall() {
    if (!isSignedIn || importState === "saving") {
      return;
    }

    setImportState("saving");
    try {
      const result = await importSharedCall({ shareToken: token });
      setImportState("saved");
      router.push(`/calls/${result.callSessionId}`);
    } catch {
      setImportState("failed");
    }
  }

  async function askCall(inputQuestion?: string) {
    const trimmedQuestion = (inputQuestion ?? question).trim();
    if (!trimmedQuestion || isAsking || !transcriptAvailable) {
      return;
    }

    setError(null);
    setQuestion("");
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: trimmedQuestion,
      createdAt: Date.now()
    };
    const nextMessages = [...messages, userMessage].slice(-20);
    setMessages(nextMessages);
    setIsAsking(true);

    try {
      const response = await fetch(`/api/shared/calls/${token}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: trimmedQuestion,
          history: nextMessages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .slice(-10)
            .map((message) => ({ role: message.role, content: message.content }))
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to answer from this call.");
      }

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant" as const,
          content: String(payload.answer ?? "I could not find that in the call."),
          createdAt: Date.now()
        }
      ].slice(-20));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to answer from this call.");
      setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      setQuestion(trimmedQuestion);
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <Card>
        <CardHeader className="p-6 md:p-8">
          <Badge className="w-fit" variant="primary">Transcript</Badge>
          <CardTitle className="text-3xl">Take the full call with you.</CardTitle>
          <CardDescription>
            Copy the full transcript with timestamps, then paste it wherever you work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 px-6 pb-6 md:px-8 md:pb-8">
          {isLoaded && isSignedIn ? (
            <Button disabled={importState === "saving"} onClick={saveSharedCall} type="button">
              {importState === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {importState === "saved" ? "Saved to my calls" : "Save to my calls"}
            </Button>
          ) : (
            <Button asChild>
              <a href={`/sign-in?redirect_url=${encodeURIComponent(`/shared/calls/${token}`)}`}>
                <LogIn className="size-4" />
                Sign in to save
              </a>
            </Button>
          )}
          {importState === "failed" ? (
            <p className="text-xs leading-5 text-destructive">
              Sidetone could not save this call. Try again.
            </p>
          ) : null}
          <Button disabled={!transcriptAvailable} onClick={copyTranscript} type="button" variant="secondary">
            <Copy className="size-4" />
            {copyState === "copied"
              ? "Transcript copied"
              : copyState === "failed"
                ? "Copy failed"
                : "Copy full transcript"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Saving creates a private copy in your calls. Copying only copies the transcript text.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge className="w-fit" variant="accent">Ask the call</Badge>
            <MessageCircle className="size-5 text-accent" />
          </div>
          <CardTitle className="text-3xl">Ask anything about this call.</CardTitle>
          <CardDescription>
            Sidetone answers from the shared transcript for {callTitle}. Your chat stays on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-4 pb-4 md:px-6 md:pb-6">
          <div
            className="enamel-panel grid max-h-[420px] min-h-[260px] gap-3 overflow-auto p-3"
            ref={listRef}
          >
            {messages.length ? (
              messages.map((message) => (
                <div
                  className={`roster-chat-bubble max-w-[92%] px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "ml-auto border-primary bg-primary text-primary-foreground"
                      : "mr-auto text-muted-foreground"
                  }`}
                  key={message.id}
                >
                  {message.content}
                </div>
              ))
            ) : (
              <div className="grid place-items-center px-4 py-8 text-center text-sm leading-6 text-muted-foreground">
                Ask for next steps, decisions, unanswered questions, follow-up wording, or anything else captured in the call.
              </div>
            )}
            {isAsking ? (
              <div className="roster-chat-bubble mr-auto flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Reading the call...
              </div>
            ) : null}
          </div>

          {messages.length ? null : (
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((suggestion) => (
                <button
                  className="rounded-md border border-border px-3 py-2 text-left font-mono text-xs font-black uppercase tracking-[0.12em] text-muted-foreground transition hover:border-primary hover:text-primary"
                  disabled={!transcriptAvailable || isAsking}
                  key={suggestion}
                  onClick={() => askCall(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void askCall();
            }}
          >
            <textarea
              className="min-h-12 flex-1 resize-none rounded-md border-[1.5px] border-[#DDD0B6] bg-[#FCF9F2] px-4 py-3 text-sm leading-6 text-[#0A192F] outline-none transition placeholder:text-[#6E83A0] hover:border-[#C7B891] focus-visible:border-[#D22B2B] focus-visible:ring-2 focus-visible:ring-[#D22B2B]/15"
              disabled={!transcriptAvailable || isAsking}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={transcriptAvailable ? "Ask about this call..." : "No transcript to ask about yet"}
              rows={1}
              value={question}
            />
            <Button disabled={!question.trim() || !transcriptAvailable || isAsking} size="icon" type="submit">
              {isAsking ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </form>
          {error ? <p className="text-sm leading-6 text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}
