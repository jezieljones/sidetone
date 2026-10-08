"use client";

import OwnerPhoneAuthCard from "./OwnerPhoneAuthCard";

export default function OwnerPhoneAuthPanel({
  afterAuthPath
}: {
  afterAuthPath?: string;
}) {
  return <OwnerPhoneAuthCard afterAuthPath={afterAuthPath} />;
}
