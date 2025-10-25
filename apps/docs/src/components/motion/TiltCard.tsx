"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import type { ReactNode } from "react";

interface TiltCardProps {
	children: ReactNode;
	className?: string;
}

export function TiltCard({ children, className }: TiltCardProps) {
	const mouseX = useMotionValue(0);
	const mouseY = useMotionValue(0);

	const rotateX = useMotionTemplate`${mouseY}deg`;
	const rotateY = useMotionTemplate`${mouseX}deg`;

	function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		const width = rect.width;
		const height = rect.height;
		const mouseXPos = event.clientX - rect.left;
		const mouseYPos = event.clientY - rect.top;

		const xPct = mouseXPos / width - 0.5;
		const yPct = mouseYPos / height - 0.5;

		mouseX.set(xPct * 20);
		mouseY.set(yPct * -20);
	}

	function handleMouseLeave() {
		mouseX.set(0);
		mouseY.set(0);
	}

	return (
		<motion.div
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			style={{
				rotateX,
				rotateY,
				transformStyle: "preserve-3d",
			}}
			transition={{
				type: "spring",
				stiffness: 300,
				damping: 30,
			}}
			className={className}
		>
			<div style={{ transform: "translateZ(50px)" }}>{children}</div>
		</motion.div>
	);
}
