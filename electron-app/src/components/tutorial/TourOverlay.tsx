import { useEffect, useState, useCallback } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TourStepDef } from './useTour';

interface TourOverlayProps {
  step: TourStepDef;
  stepIndex: number;
  totalSteps: number;
  /** Whether the Next button should be enabled (ignored for autoAdvance steps). */
  canAdvance: boolean;
  onNext: () => void;
  onExit: () => void;
}

interface Rect { top: number; left: number; width: number; height: number }

const PADDING = 6;   // px around highlight box
const CARD_W  = 360; // px — tooltip card width

export function TourOverlay({ step, stepIndex, totalSteps, canAdvance, onNext, onExit }: TourOverlayProps) {
  const [rect, setRect] = useState<Rect>({ top: 0, left: 0, width: 0, height: 0 });

  const measureTarget = useCallback(() => {
    const el = document.querySelector(`[data-tour-id="${step.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [step.id]);

  useEffect(() => {
    measureTarget();
    const id = setInterval(measureTarget, 200); // keep in sync with layout shifts
    window.addEventListener('resize', measureTarget);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', measureTarget);
    };
  }, [measureTarget]);

  const hTop  = rect.top  - PADDING;
  const hLeft = rect.left - PADDING;
  const hW    = rect.width  + PADDING * 2;
  const hH    = rect.height + PADDING * 2;

  // Place card below the target; if that would overflow, place above.
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const cardTop = spaceBelow > 200
    ? rect.top + rect.height + PADDING + 8
    : rect.top - PADDING - 8 - 180; // approx card height

  const cardLeft = Math.max(12, Math.min(rect.left, window.innerWidth - CARD_W - 12));

  const isLast = stepIndex === totalSteps - 1;

  return (
    <>
      {/* ── Dimmed overlay (4 rects around the cutout) ────────────────── */}
      {/* Top band */}
      <div
        className="fixed z-[9998] bg-black/60 pointer-events-none"
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, hTop) }}
      />
      {/* Bottom band */}
      <div
        className="fixed z-[9998] bg-black/60 pointer-events-none"
        style={{ top: hTop + hH, left: 0, right: 0, bottom: 0 }}
      />
      {/* Left band */}
      <div
        className="fixed z-[9998] bg-black/60 pointer-events-none"
        style={{ top: hTop, left: 0, width: Math.max(0, hLeft), height: hH }}
      />
      {/* Right band */}
      <div
        className="fixed z-[9998] bg-black/60 pointer-events-none"
        style={{ top: hTop, left: hLeft + hW, right: 0, height: hH }}
      />

      {/* ── Highlight ring ─────────────────────────────────────────────── */}
      <div
        className="fixed z-[9999] rounded-lg pointer-events-none transition-all duration-200"
        style={{
          top: hTop,
          left: hLeft,
          width: hW,
          height: hH,
          boxShadow: '0 0 0 2px hsl(var(--primary)), 0 0 0 4px hsl(var(--primary) / 0.3)',
        }}
      />

      {/* ── Pulse ring (autoAdvance = user must click the element) ──────── */}
      {step.autoAdvance && (
        <div
          className="fixed z-[9999] rounded-lg pointer-events-none animate-ping"
          style={{
            top: hTop,
            left: hLeft,
            width: hW,
            height: hH,
            boxShadow: '0 0 0 3px hsl(var(--primary) / 0.5)',
          }}
        />
      )}

      {/* ── Tooltip card ───────────────────────────────────────────────── */}
      <Card
        className="fixed z-[10000] shadow-2xl"
        style={{ top: cardTop, left: cardLeft, width: CARD_W }}
      >
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                Step {stepIndex + 1} of {totalSteps}
              </p>
              <CardTitle className="text-sm leading-snug">{step.title}</CardTitle>
            </div>

            {/* ── EXIT TOUR — always visible ──────────────────────────── */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onExit}
              className="shrink-0 h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
              data-testid="button-tour-exit"
            >
              <X className="w-3 h-3" />
              Exit Tour
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-4 pb-4 space-y-3">
          <p className="text-sm text-foreground leading-relaxed">{step.description}</p>

          {step.autoAdvance ? (
            /* autoAdvance steps: tell the user to interact — no Next button */
            <p className="text-xs text-muted-foreground italic">
              👆 Perform the action above to continue automatically.
            </p>
          ) : (
            /* Manual steps: Next/Done button, disabled until canAdvance */
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={onNext}
                disabled={!canAdvance}
                className="gap-1.5"
                data-testid="button-tour-next"
              >
                {step.nextLabel ?? (
                  <>
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
              {!canAdvance && !isLast && (
                <p className="text-[10px] text-muted-foreground self-center ml-2">
                  Fill in the field above first
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
