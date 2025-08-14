import { StringSelectMenuOptionBuilder } from "discord.js";

export interface TeamOption {
  id: string;
  name: string;
  description: string;
}

export const KC_TEAMS: TeamOption[] = [
  {
    id: "134078",
    name: "KC (LEC)",
    description: "Équipe principale League of Legends",
  },
  {
    id: "128268",
    name: "KCB (LFL)",
    description: "Équipe académique League of Legends",
  },
  {
    id: "136080",
    name: "KCBS (LFL2)",
    description: "Équipe LFL2 League of Legends",
  },
  {
    id: "130922",
    name: "KC Valorant",
    description: "Équipe principale Valorant",
  },
  {
    id: "132777",
    name: "KCGC Valorant",
    description: "Équipe féminine Valorant",
  },
  {
    id: "136165",
    name: "KCBS Valorant",
    description: "Équipe KCBS Valorant",
  },
  {
    id: "129570",
    name: "KC Rocket League",
    description: "Équipe Rocket League",
  },
];

export function createTeamChoices() {
  return KC_TEAMS.map((team) => ({
    name: team.name,
    value: team.id,
  }));
}

export function createTeamMenuOptions(
  filteredTeams: string[] = [],
  includeAllOption: boolean = true
): StringSelectMenuOptionBuilder[] {
  const options: StringSelectMenuOptionBuilder[] = [];

  if (includeAllOption) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel("Toutes les équipes")
        .setDescription(
          filteredTeams.length > 0
            ? `Voir le prochain match des équipes filtrées (${filteredTeams.length} équipe(s))`
            : "Voir le prochain match de toutes les équipes"
        )
        .setValue("all")
    );
  }

  KC_TEAMS.forEach((team) => {
    if (filteredTeams.length === 0 || filteredTeams.includes(team.id)) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(team.name)
          .setDescription(team.description)
          .setValue(team.id)
      );
    }
  });

  return options;
}

export function findTeamById(id: string): TeamOption | undefined {
  return KC_TEAMS.find((team) => team.id === id);
}

export function findTeamByName(name: string): TeamOption | undefined {
  return KC_TEAMS.find((team) => team.name === name);
}

export function getAllTeamIds(): string[] {
  return KC_TEAMS.map((team) => team.id);
}

export function getAllTeamNames(): string[] {
  return KC_TEAMS.map((team) => team.name);
}
