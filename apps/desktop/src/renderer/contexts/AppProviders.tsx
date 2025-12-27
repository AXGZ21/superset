import type React from "react";
import { PostHogUserIdentifier } from "renderer/components/PostHogUserIdentifier";
import { PGliteProvider } from "renderer/lib/pglite";
import { MonacoProvider } from "./MonacoProvider";
import { OrganizationsProvider } from "./OrganizationsProvider";
import { PostHogProvider } from "./PostHogProvider";
import { TRPCProvider } from "./TRPCProvider";

interface AppProvidersProps {
	children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
	return (
		<PostHogProvider>
			<TRPCProvider>
				<PostHogUserIdentifier />
				<OrganizationsProvider>
					<PGliteProvider>
						<MonacoProvider>{children}</MonacoProvider>
					</PGliteProvider>
				</OrganizationsProvider>
			</TRPCProvider>
		</PostHogProvider>
	);
}
