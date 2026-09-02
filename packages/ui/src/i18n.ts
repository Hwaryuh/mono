export type UiMessages = {
  weekdays: readonly [string, string, string, string, string, string, string];
  dateMonth: string;
  dateDay: string;
  dateTodaySuffix: string;
  dateSelectedSuffix: string;
  dateSelect: string;
  pickerSelect: string;
  previousMonth: string;
  nextMonth: string;
  clear: string;
  today: string;
  select: string;
  options: string;
  colorSelect: string;
  colorSelectClose: string;
  hue: string;
  hexColor: string;
  timeSelect: string;
  timeDialogOpen: string;
  am: string;
  pm: string;
  hour: string;
  minute: string;
  done: string;
  confidence: string;
  close: string;
};

let messages: UiMessages = {
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  dateMonth: "{year}-{month}",
  dateDay: "{year}-{month}-{day}",
  dateTodaySuffix: ", today",
  dateSelectedSuffix: ", selected",
  dateSelect: "Select date",
  pickerSelect: "Select {label}",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  clear: "Clear",
  today: "Today",
  select: "Select",
  options: "{label} options",
  colorSelect: "Select color",
  colorSelectClose: "Close color picker",
  hue: "Hue",
  hexColor: "HEX color",
  timeSelect: "Select time",
  timeDialogOpen: "Open {label} dial",
  am: "AM",
  pm: "PM",
  hour: "hour",
  minute: "minute",
  done: "Done",
  confidence: "Confidence",
  close: "Close",
};

export function configureUiMessages(nextMessages: UiMessages) {
  messages = nextMessages;
}

export function uiMessage(key: Exclude<keyof UiMessages, "weekdays">, values?: Record<string, string | number>) {
  const template = messages[key] as string;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

export function uiWeekdays() {
  return messages.weekdays;
}
