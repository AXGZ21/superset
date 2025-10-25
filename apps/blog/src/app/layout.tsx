import * as React from "react";
import { Footer, Layout, Navbar, ThemeSwitch } from "nextra-theme-blog";
import { Banner, Search } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-blog/style.css";

export const metadata = {
	title: "Superset Blog",
	description: "Latest news and updates from Superset",
};

const banner = (
	<Banner storageKey="superset-blog-banner">
		Welcome to the Superset Blog
	</Banner>
);

export default async function BlogLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<Layout banner={banner}>
					<Navbar pageMap={await getPageMap()}>
						<Search />
						<ThemeSwitch />
					</Navbar>
					{children}
					<Footer>
						<p>
							© {new Date().getFullYear()} Superset. All rights
							reserved.
						</p>
					</Footer>
				</Layout>
			</body>
		</html>
	);
}
