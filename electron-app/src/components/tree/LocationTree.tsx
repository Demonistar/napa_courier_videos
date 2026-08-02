import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, MapPin, Plus } from 'lucide-react';
import { Location } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LocationTreeProps {
  locations: Location[];
  selectedLocationId: string | null;
  onSelectLocation: (id: string) => void;
  searchQuery: string;
  onAddLocation: () => void;
}

interface TreeNode {
  state: string;
  cities: {
    name: string;
    locations: Location[];
  }[];
}

export function LocationTree({
  locations,
  selectedLocationId,
  onSelectLocation,
  searchQuery,
  onAddLocation,
}: LocationTreeProps) {
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set());
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const stateMap = new Map<string, Map<string, Location[]>>();

    locations.forEach((loc) => {
      if (!stateMap.has(loc.state)) {
        stateMap.set(loc.state, new Map());
      }
      const cityMap = stateMap.get(loc.state)!;
      if (!cityMap.has(loc.city)) {
        cityMap.set(loc.city, []);
      }
      cityMap.get(loc.city)!.push(loc);
    });

    const result: TreeNode[] = [];
    stateMap.forEach((cityMap, state) => {
      const cities: { name: string; locations: Location[] }[] = [];
      cityMap.forEach((locs, city) => {
        cities.push({ name: city, locations: locs.sort((a, b) => a.siteName.localeCompare(b.siteName)) });
      });
      result.push({
        state,
        cities: cities.sort((a, b) => a.name.localeCompare(b.name)),
      });
    });

    return result.sort((a, b) => a.state.localeCompare(b.state));
  }, [locations]);

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;

    const query = searchQuery.toLowerCase();
    return tree
      .map((stateNode) => ({
        ...stateNode,
        cities: stateNode.cities
          .map((cityNode) => ({
            ...cityNode,
            locations: cityNode.locations.filter(
              (loc) =>
                loc.siteName.toLowerCase().includes(query) ||
                loc.accountNumber.toLowerCase().includes(query) ||
                loc.city.toLowerCase().includes(query) ||
                loc.state.toLowerCase().includes(query) ||
                loc.address.toLowerCase().includes(query) ||
                loc.instructions.toLowerCase().includes(query)
            ),
          }))
          .filter((cityNode) => cityNode.locations.length > 0),
      }))
      .filter((stateNode) => stateNode.cities.length > 0);
  }, [tree, searchQuery]);

  const toggleState = (state: string) => {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(state)) {
        next.delete(state);
      } else {
        next.add(state);
      }
      return next;
    });
  };

  const toggleCity = (stateCity: string) => {
    setExpandedCities((prev) => {
      const next = new Set(prev);
      if (next.has(stateCity)) {
        next.delete(stateCity);
      } else {
        next.add(stateCity);
      }
      return next;
    });
  };

  const highlightText = (text: string) => {
    if (!searchQuery.trim()) return text;

    const query = searchQuery.toLowerCase();
    const index = text.toLowerCase().indexOf(query);
    if (index === -1) return text;

    return (
      <>
        {text.slice(0, index)}
        <mark className="bg-accent/30 text-foreground">{text.slice(index, index + searchQuery.length)}</mark>
        {text.slice(index + searchQuery.length)}
      </>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filteredTree.map((stateNode) => {
            const isStateExpanded = expandedStates.has(stateNode.state);
            return (
              <div key={stateNode.state}>
                <button
                  onClick={() => toggleState(stateNode.state)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium rounded hover:bg-accent transition-colors"
                  data-testid={`tree-state-${stateNode.state}`}
                >
                  {isStateExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span>{highlightText(stateNode.state)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    ({stateNode.cities.reduce((sum, c) => sum + c.locations.length, 0)})
                  </span>
                </button>

                {isStateExpanded && (
                  <div className="ml-4 space-y-1 mt-1">
                    {stateNode.cities.map((cityNode) => {
                      const stateCityKey = `${stateNode.state}-${cityNode.name}`;
                      const isCityExpanded = expandedCities.has(stateCityKey);
                      return (
                        <div key={stateCityKey}>
                          <button
                            onClick={() => toggleCity(stateCityKey)}
                            className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors"
                            data-testid={`tree-city-${stateCityKey}`}
                          >
                            {isCityExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span>{highlightText(cityNode.name)}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              ({cityNode.locations.length})
                            </span>
                          </button>

                          {isCityExpanded && (
                            <div className="ml-4 space-y-0.5 mt-0.5">
                              {cityNode.locations.map((loc) => (
                                <button
                                  key={loc.id}
                                  onClick={() => onSelectLocation(loc.id)}
                                  className={cn(
                                    'flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors',
                                    selectedLocationId === loc.id
                                      ? 'bg-primary text-primary-foreground'
                                      : 'hover:bg-accent'
                                  )}
                                  data-testid={`tree-location-${loc.id}`}
                                >
                                  <MapPin className="w-4 h-4 shrink-0" />
                                  <span className="truncate">{highlightText(loc.siteName)}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {filteredTree.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No locations match your search
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-3 border-t">
        <Button
          onClick={onAddLocation}
          className="w-full"
          size="sm"
          data-testid="button-add-location-tree"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Location
        </Button>
      </div>
    </div>
  );
}
