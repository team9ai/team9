provider "aws" {
  region  = "us-east-1"
  profile = "t9"

  default_tags {
    tags = {
      Project   = "team9"
      ManagedBy = "Terraform"
      Account   = "t9"
    }
  }
}
