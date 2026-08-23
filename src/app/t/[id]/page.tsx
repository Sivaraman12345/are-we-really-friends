import type { Metadata } from "next";
import { getTest, getParticipantsByTestId } from "@/lib/db";
import FriendJoinClient from "./FriendJoinClient";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const test = await getTest(id);
  const participants = test ? await getParticipantsByTestId(id) : [];
  const participantA = participants.find((p) => p.role === "A");
  const creatorName = participantA?.display_name?.trim();

  const title = creatorName
    ? `${creatorName} challenged you: Are We Really Friends?`
    : "You've been invited — Are We Really Friends?";

  const description = creatorName
    ? `${creatorName} completed 8 situational dilemmas and challenged you. Answer independently to reveal your friendship matrix.`
    : "Your friend completed 8 situational dilemmas and challenged you. Answer independently to reveal your friendship matrix.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `/t/${id}`,
      images: [
        {
          url: `/api/og/invite/${id}`,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/api/og/invite/${id}`],
    },
    alternates: {
      canonical: `/t/${id}`,
    },
  };
}

export default function FriendJoinPage({ params }: Props) {
  return <FriendJoinClient params={params} />;
}
