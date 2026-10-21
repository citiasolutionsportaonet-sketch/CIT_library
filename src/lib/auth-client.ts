"use client";
import { createAuthClient } from "better-auth/react";

// Mesma origem da página: funciona em localhost, IP da rede ou hostname .local.
export const authClient = createAuthClient();
