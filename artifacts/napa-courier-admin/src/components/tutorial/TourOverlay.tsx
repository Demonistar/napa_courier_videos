import { useEffect, useState, useRef } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface TourStep {
  target: string; // data-tour-id
  title: string;
  description: string;
}

interface TourOverlayProps {
  steps: TourStep[];
  onComplete: () => void;
}

export function TourOverlay({ steps, onComplete }: TourOverlayProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updatePosition = () => {
      const step = steps[currentStep];
      const element = document.querySelector(`[data-tour-id="${step.target}"]`);

      if (element) {
        const rect = element.getBoundingClientRect();
        setPosition({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [currentStep, steps]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const step = steps[currentStep];
  const tooltipTop = position.top + position.height + 16;
  const tooltipLeft = Math.max(16, Math.min(position.left, window.innerWidth - 400));

  return (
    <>
      {/* Overlay with cutout */}
      <div
        className="fixed inset-0 z-[9998] pointer-events-none"
        style={{
          background: `
            linear-gradient(to right, 
              rgba(0, 0, 0, 0.6) 0%, 
              rgba(0, 0, 0, 0.6) ${position.left}px, 
              transparent ${position.left}px, 
              transparent ${position.left + position.width}px, 
              rgba(0, 0, 0, 0.6) ${position.left + position.width}px, 
              rgba(0, 0, 0, 0.6) 100%),
            linear-gradient(to bottom, 
              rgba(0, 0, 0, 0.6) 0%, 
              rgba(0, 0, 0, 0.6) ${position.top}px, 
              transparent ${position.top}px, 
              transparent ${position.top + position.height}px, 
              rgba(0, 0, 0, 0.6) ${position.top + position.height}px, 
              rgba(0, 0, 0, 0.6) 100%)
          `,
        }}
      />

      {/* Highlight box */}
      <div
        className="fixed z-[9999] border-2 border-primary rounded-lg pointer-events-none transition-all duration-300"
        style={{
          top: position.top - 4,
          left: position.left - 4,
          width: position.width + 8,
          height: position.height + 8,
        }}
      />

      {/* Tooltip */}
      <Card
        ref={tooltipRef}
        className="fixed z-[10000] w-96 shadow-2xl"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
        }}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <CardTitle className="text-lg">{step.title}</CardTitle>
              <CardDescription className="text-xs mt-1">
                Step {currentStep + 1} of {steps.length}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mt-1 -mr-1"
              onClick={onComplete}
              data-testid="button-tour-close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground">{step.description}</p>

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrev}
              disabled={currentStep === 0}
              data-testid="button-tour-prev"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>

            <Button variant="ghost" size="sm" onClick={onComplete} data-testid="button-tour-skip">
              Skip Tour
            </Button>

            <Button onClick={handleNext} size="sm" data-testid="button-tour-next">
              {currentStep < steps.length - 1 ? (
                <>
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </>
              ) : (
                'Finish'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
