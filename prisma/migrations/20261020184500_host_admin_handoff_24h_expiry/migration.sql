-- Erweitert die Gültigkeitsfrist für den vom Support ausgestellten Übergabecode
-- (HostAdminHandoff) von 15 Minuten auf bis zu 24 Stunden, da die Zustellung an
-- den verifizierten Host asynchron erfolgt. Das interaktive 15-Minuten-Fenster
-- nach Prepare (HostCredentialExchange) bleibt unverändert.

ALTER TABLE "HostAdminHandoff" DROP CONSTRAINT "HostAdminHandoff_bounded_expiry";

ALTER TABLE "HostAdminHandoff"
  ADD CONSTRAINT "HostAdminHandoff_bounded_expiry"
    CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '24 hours');
