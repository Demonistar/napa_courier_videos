import { useState } from 'react';

export interface TourStepDef {
  /** Matches the data-tour-id of the element to highlight. */
  id: string;
  title: string;
  description: string;
  /**
   * If true, the overlay shows no Next button — progression is triggered
   * automatically when the user performs the real UI action (clicking a button,
   * submitting the form, etc.).  The dashboard wires this via advanceTour().
   */
  autoAdvance?: boolean;
  /** Label override for the Next/confirm button. Defaults to 'Next →'. */
  nextLabel?: string;
}

/** Ordered list of every step in the Add-Location guided tour. */
export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'add-button',
    autoAdvance: true,
    title: 'Step 1 — Add a Location',
    description:
      'Click the "Add New Location" button (highlighted) to open the new location form.',
  },
  {
    id: 'field-state',
    title: 'Step 2 — Select a State',
    description:
      'Choose the state for this location from the dropdown. Once a state is selected, "Next" will become active.',
  },
  {
    id: 'field-city',
    title: 'Step 3 — Select a City',
    description:
      'Choose or type the city. Once a city is entered, "Next" will become active.',
  },
  {
    id: 'field-site-name',
    title: 'Step 4 — Site Name',
    description:
      'Type the name of the delivery site (e.g. "Sheriff\'s Office"). Click Next when done.',
  },
  {
    id: 'field-address',
    title: 'Step 5 — Address',
    description:
      'Type the full street address. Click Next when done.',
  },
  {
    id: 'form-actions',
    autoAdvance: true,
    title: 'Step 6 — Save or Cancel',
    description:
      'Click "Create Location" to add the location, or "Cancel" to discard it. The tour will continue either way.',
  },
  {
    id: 'new-location',
    nextLabel: 'Done ✓',
    title: 'Tour Complete!',
    description:
      'Your new location now appears here in the tree. Click "Done" to finish the tour.',
  },
];

export function useTour() {
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  const [tourNewLocationId, setTourNewLocationId] = useState<string | null>(null);

  const startTour = () => {
    setTourStepIndex(0);
    setTourNewLocationId(null);
    setIsTourActive(true);
  };

  const exitTour = () => {
    setIsTourActive(false);
    setTourStepIndex(0);
    setTourNewLocationId(null);
  };

  const advanceTour = () => {
    const next = tourStepIndex + 1;
    if (next >= TOUR_STEPS.length) {
      exitTour();
    } else {
      setTourStepIndex(next);
    }
  };

  return {
    isTourActive,
    tourStepIndex,
    startTour,
    exitTour,
    advanceTour,
    tourNewLocationId,
    setTourNewLocationId,
    // Legacy alias so nothing else that calls endTour() breaks
    endTour: exitTour,
  };
}
