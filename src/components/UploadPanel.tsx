"use client";

import { useEffect, useState } from "react";
import { NER_BACKEND_LIST, getRecommendedBackendId, type NerBackendId } from "@/lib/ner";

interface Props {
  onStart: (file: File, nerBackendId: NerBackendId | null) => void;
  disabled: boolean;
}

export default function UploadPanel({ onStart, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [nerBackendId, setNerBackendId] = useState<NerBackendId | null>(null);
  const [recommended, setRecommended] = useState<NerBackendId | null>(null);

  // `getRecommendedBackendId` depends on `navigator.gpu`, which doesn't
  // exist during SSR. This is the sanctioned exception to "don't setState in
  // an effect": there is no server-computable value here, so an
  // effect-after-mount is the only way to read it without diverging from
  // the SSR-rendered HTML.
  useEffect(() => {
    const rec = getRecommendedBackendId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same as above
    setRecommended(rec);
    setNerBackendId(rec);
  }, []);

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 p-6 dark:border-gray-700">
      <div>
        <h2 className="mb-1 font-semibold">1. Choose a PDF</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Digital or scanned - scanned pages are OCR&apos;d automatically. Nothing leaves your device.
        </p>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-700 dark:file:bg-gray-100 dark:file:text-gray-900"
        />
      </div>

      <div>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            <input
              type="radio"
              name="ner-backend"
              checked={nerBackendId === null}
              onChange={() => setNerBackendId(null)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">None - regex only</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Instant, no download. Misses free-text names/orgs; relies entirely on the review screen for those.
              </span>
            </span>
          </label>
          {NER_BACKEND_LIST.map((backend) => (
            <label
              key={backend.id}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              <input
                type="radio"
                name="ner-backend"
                checked={nerBackendId === backend.id}
                onChange={() => setNerBackendId(backend.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">
                  {backend.label}
                  {backend.id === recommended && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-normal text-green-800 dark:bg-green-900 dark:text-green-200">
                      recommended
                    </span>
                  )}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {backend.description} ~{backend.approxSizeMb}MB download, cached after first load.
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <button
        onClick={() => file && onStart(file, nerBackendId)}
        disabled={!file || disabled}
        className="w-full rounded-md bg-gray-900 px-4 py-2.5 font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
      >
        Detect PII
      </button>
    </div>
  );
}
