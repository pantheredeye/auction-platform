import { useState, useCallback } from "react";
import type { ChatMessage } from "@/auction/types";

export function useChat() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const handleChatHistory = useCallback((messages: ChatMessage[]) => {
    setChatMessages(messages);
  }, []);

  const handleChatMessage = useCallback((msg: ChatMessage) => {
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  return { chatMessages, handleChatHistory, handleChatMessage };
}
