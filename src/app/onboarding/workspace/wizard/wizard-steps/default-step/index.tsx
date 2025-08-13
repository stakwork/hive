import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TWizardStep } from "@/stores/useWizardStore";

interface WelcomeStepProps {
  step: TWizardStep;
  handleBackToStep: () => void;
}

export const DefaultStep = ({ handleBackToStep, step }: WelcomeStepProps) => {
  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-red-600">Invalid Step</CardTitle>
        <CardDescription>
          The wizard step {step} is not recognized. Please start over or contact
          support.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-4">
        <Button variant="outline" onClick={() => handleBackToStep()}>
          Start Over
        </Button>
      </CardContent>
    </Card>
  );
};
