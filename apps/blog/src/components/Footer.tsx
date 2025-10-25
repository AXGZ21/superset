"use client";

import { motion } from "framer-motion";

const FOOTER_LINKS = {
	Product: [
		{ label: "Pricing", href: "#" },
		{ label: "Features", href: "#" },
		{ label: "Download", href: "#" },
	],
	Company: [
		{ label: "About", href: "#" },
		{ label: "Careers", href: "#" },
		{ label: "Contact", href: "#" },
	],
	Resources: [
		{ label: "Documentation", href: "#" },
		{ label: "Support", href: "#" },
		{ label: "Privacy", href: "#" },
	],
	Connect: [
		{ label: "GitHub", href: "#" },
		{ label: "Twitter", href: "#" },
		{ label: "Discord", href: "#" },
	],
} as const;

export function Footer() {
	return (
		<footer className="bg-black border-t border-zinc-800">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-12 sm:py-16 md:py-20">
				{/* Main footer content */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-12">
					{Object.entries(FOOTER_LINKS).map(([category, links], idx) => (
						<motion.div
							key={category}
							initial={{ opacity: 0, y: 20 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true }}
							transition={{ duration: 0.5, delay: idx * 0.1 }}
						>
							<h3 className="text-white font-semibold mb-4 text-sm sm:text-base">
								{category}
							</h3>
							<ul className="space-y-3">
								{links.map((link) => (
									<li key={link.label}>
										<a
											href={link.href}
											className="text-zinc-400 hover:text-white transition-colors text-sm"
										>
											{link.label}
										</a>
									</li>
								))}
							</ul>
						</motion.div>
					))}
				</div>

				{/* Bottom section */}
				<motion.div
					initial={{ opacity: 0 }}
					whileInView={{ opacity: 1 }}
					viewport={{ once: true }}
					transition={{ duration: 0.5, delay: 0.4 }}
					className="pt-8 border-t border-zinc-800 flex flex-col sm:flex-row justify-between items-center gap-4"
				>
					<div className="flex items-center gap-2">
						<span className="text-white font-bold text-2xl">⊇</span>
						<span className="text-white font-semibold">Superset</span>
					</div>
					<p className="text-zinc-400 text-sm">
						© {new Date().getFullYear()} Superset. All rights reserved.
					</p>
				</motion.div>
			</div>
		</footer>
	);
}
